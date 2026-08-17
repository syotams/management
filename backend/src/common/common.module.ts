import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { EmailService } from './email.service';

@Module({
  providers: [AuditService, EmailService],
  exports: [AuditService, EmailService],
})
export class CommonModule {}
