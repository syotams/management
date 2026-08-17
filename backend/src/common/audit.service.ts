import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(
    taskId: string,
    userId: string,
    action: string,
    fieldName?: string,
    oldValue?: string | null,
    newValue?: string | null,
  ) {
    return this.prisma.taskAuditLog.create({
      data: { taskId, userId, action, fieldName, oldValue, newValue },
    });
  }
}
