import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { CommonModule } from '../common/common.module';
import { TaskListsModule } from '../task-lists/task-lists.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [CommonModule, TaskListsModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
