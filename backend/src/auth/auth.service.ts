import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { RegisterDto, LoginDto, UpdateMeDto, ForgotPasswordDto, ResetPasswordDto } from './dto/auth.dto';
import { resolveTimeZone } from '../common/date.util';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const FORGOT_PASSWORD_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private email: EmailService,
    private config: ConfigService,
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

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { message: FORGOT_PASSWORD_MESSAGE };

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await this.prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: this.hashResetToken(token), expiresAt },
    });

    const appUrl = this.config.get<string>('APP_URL') || 'http://localhost:4200';
    try {
      await this.email.sendPasswordReset(user.email, `${appUrl}/reset-password?token=${token}`);
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${user.email}`, err instanceof Error ? err.stack : err);
    }
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: this.hashResetToken(dto.token) },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      this.prisma.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    ]);
    return { message: 'Password updated. You can log in with your new password.' };
  }

  private hashResetToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private signToken(id: string, email: string) {
    return this.jwtService.sign({ sub: id, email });
  }

  private sanitize(user: { id: string; email: string; name: string; timezone: string; createdAt: Date }) {
    return { id: user.id, email: user.email, name: user.name, timezone: user.timezone, createdAt: user.createdAt };
  }
}
