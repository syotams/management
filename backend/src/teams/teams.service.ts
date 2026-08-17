import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { CreateTeamDto, InviteMemberDto } from './dto/team.dto';

const INVITE_EXPIRY_DAYS = 5;

@Injectable()
export class TeamsService {
  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private config: ConfigService,
  ) {}

  async create(userId: string, dto: CreateTeamDto) {
    const team = await this.prisma.team.create({
      data: {
        name: dto.name,
        createdBy: userId,
        members: { create: { userId, role: 'owner' } },
      },
      include: { members: { include: { user: { select: { id: true, email: true } } } } },
    });
    return team;
  }

  async findAll(userId: string) {
    return this.prisma.team.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { include: { user: { select: { id: true, email: true } } } },
        _count: { select: { members: true } },
      },
    });
  }

  async getMembers(teamId: string, userId: string) {
    await this.ensureMember(teamId, userId);
    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { id: true, email: true } } },
    });
    const invites = await this.prisma.teamInvite.findMany({
      where: { teamId, status: { in: ['pending', 'expired'] } },
      orderBy: { createdAt: 'desc' },
    });

    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:4200';
    return {
      members,
      invites: invites.map((inv) => ({
        ...inv,
        inviteLink: inv.status === 'pending' && inv.expiresAt > new Date()
          ? `${appUrl}/invites/${inv.token}`
          : null,
        daysUntilExpiry: Math.max(0, Math.ceil((inv.expiresAt.getTime() - Date.now()) / 86400000)),
      })),
    };
  }

  async invite(teamId: string, userId: string, dto: InviteMemberDto) {
    await this.ensureOwner(teamId, userId);
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    const existingMember = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingMember) {
      const member = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: existingMember.id } },
      });
      if (member) throw new ConflictException('User is already a team member');
    }

    const pending = await this.prisma.teamInvite.findFirst({
      where: { teamId, email: dto.email, status: 'pending', expiresAt: { gt: new Date() } },
    });
    if (pending) throw new ConflictException('Pending invite already exists');

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    const invite = await this.prisma.teamInvite.create({
      data: { teamId, email: dto.email, token, invitedBy: userId, expiresAt },
    });

    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:4200';
    const inviteLink = `${appUrl}/invites/${token}`;
    await this.email.sendInvite(dto.email, team.name, inviteLink);

    return { ...invite, inviteLink };
  }

  async reinvite(teamId: string, inviteId: string, userId: string) {
    await this.ensureOwner(teamId, userId);
    const old = await this.prisma.teamInvite.findFirst({ where: { id: inviteId, teamId } });
    if (!old) throw new NotFoundException('Invite not found');

    await this.prisma.teamInvite.update({
      where: { id: inviteId },
      data: { status: 'expired' },
    });

    return this.invite(teamId, userId, { email: old.email });
  }

  async revokeInvite(teamId: string, inviteId: string, userId: string) {
    await this.ensureOwner(teamId, userId);
    await this.prisma.teamInvite.updateMany({
      where: { id: inviteId, teamId },
      data: { status: 'expired' },
    });
    return { success: true };
  }

  async removeMember(teamId: string, memberUserId: string, userId: string) {
    await this.ensureOwner(teamId, userId);
    if (memberUserId === userId) {
      throw new ForbiddenException('Cannot remove yourself as owner');
    }
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: memberUserId } },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner') throw new ForbiddenException('Cannot remove team owner');

    await this.prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId: memberUserId } },
    });
    return { success: true };
  }

  async acceptInvite(token: string, userId: string) {
    const invite = await this.prisma.teamInvite.findUnique({
      where: { token },
      include: { team: true },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status === 'accepted') throw new ConflictException('Invite already accepted');
    if (invite.status === 'expired' || invite.expiresAt < new Date()) {
      await this.prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'expired' } });
      throw new GoneException('Invite has expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException('Invite email does not match your account');
    }

    await this.prisma.$transaction([
      this.prisma.teamMember.create({
        data: { teamId: invite.teamId, userId, role: 'member' },
      }),
      this.prisma.teamInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted' },
      }),
    ]);

    return { teamId: invite.teamId, teamName: invite.team.name };
  }

  async getInviteInfo(token: string) {
    const invite = await this.prisma.teamInvite.findUnique({
      where: { token },
      include: { team: { select: { name: true } } },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    const expired = invite.status === 'expired' || invite.expiresAt < new Date();
    return {
      email: invite.email,
      teamName: invite.team.name,
      status: expired ? 'expired' : invite.status,
      expiresAt: invite.expiresAt,
    };
  }

  async getTeamMembersForAssignment(userId: string) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);
    const members = await this.prisma.teamMember.findMany({
      where: { teamId: { in: teamIds } },
      include: { user: { select: { id: true, email: true } }, team: { select: { id: true, name: true } } },
    });
    const unique = new Map<string, { id: string; email: string; teamId: string; teamName: string }>();
    for (const m of members) {
      unique.set(m.user.id, {
        id: m.user.id,
        email: m.user.email,
        teamId: m.team.id,
        teamName: m.team.name,
      });
    }
    return Array.from(unique.values());
  }

  private async ensureMember(teamId: string, userId: string) {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a team member');
    return member;
  }

  private async ensureOwner(teamId: string, userId: string) {
    const member = await this.ensureMember(teamId, userId);
    if (member.role !== 'owner') throw new ForbiddenException('Only team owner can perform this action');
    return member;
  }
}
