import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TaskListsService } from './task-lists.service';
import { CreateTaskListDto, DeleteTaskListQueryDto, RenameTaskListDto } from './dto/task-list.dto';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('task-lists')
@UseGuards(AuthGuard('jwt'))
export class TaskListsController {
  constructor(private taskListsService: TaskListsService) {}

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.taskListsService.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateTaskListDto) {
    return this.taskListsService.create(user.id, dto.name);
  }

  @Patch(':id')
  rename(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: RenameTaskListDto,
  ) {
    return this.taskListsService.rename(user.id, id, dto.name);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Query() query: DeleteTaskListQueryDto,
  ) {
    return this.taskListsService.remove(user.id, id, query.moveTo);
  }
}
