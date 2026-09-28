import { Module } from '@nestjs/common';
import { TaskListsService } from './task-lists.service';
import { TaskListsController } from './task-lists.controller';

@Module({
  controllers: [TaskListsController],
  providers: [TaskListsService],
  exports: [TaskListsService],
})
export class TaskListsModule {}
