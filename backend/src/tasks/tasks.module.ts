import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { CommonModule } from '../common/common.module';
import { TaskListsModule } from '../task-lists/task-lists.module';

@Module({
  imports: [CommonModule, TaskListsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
