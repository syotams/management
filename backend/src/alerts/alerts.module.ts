import { Module } from '@nestjs/common';
import { AlertsScheduler } from './alerts.scheduler';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  providers: [AlertsScheduler],
})
export class AlertsModule {}
