import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto, UpdateMeDto } from './dto/auth.dto';
import { resolveTimeZone } from '../common/date.util';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    const existingName = await this.prisma.user.findUnique({ where: { name: dto.name } });
    if (existingName) {
      throw new ConflictException('Username already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        timezone: resolveTimeZone(dto.timezone),
      },
    });

    return { accessToken: this.signToken(user.id, user.email), user: this.sanitize(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let current = user;
    if (dto.timezone) {
      const timezone = resolveTimeZone(dto.timezone);
      if (timezone !== user.timezone) {
        current = await this.prisma.user.update({ where: { id: user.id }, data: { timezone } });
      }
    }

    return { accessToken: this.signToken(current.id, current.email), user: this.sanitize(current) };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.sanitize(user);
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const data: { timezone?: string } = {};
    if (dto.timezone !== undefined) {
      data.timezone = resolveTimeZone(dto.timezone);
    }
    const updated = Object.keys(data).length
      ? await this.prisma.user.update({ where: { id: userId }, data })
      : user;
    return this.sanitize(updated);
  }

  private signToken(id: string, email: string) {
    return this.jwtService.sign({ sub: id, email });
  }

  private sanitize(user: { id: string; email: string; name: string; timezone: string; createdAt: Date }) {
    return { id: user.id, email: user.email, name: user.name, timezone: user.timezone, createdAt: user.createdAt };
  }
}
