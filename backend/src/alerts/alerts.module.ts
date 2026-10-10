import { Module } from '@nestjs/common';
import { AlertsScheduler } from './alerts.scheduler';
import { CommonModule } from '../common/common.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CommonModule, NotificationsModule],
  providers: [AlertsScheduler],
})
export class AlertsModule {}
