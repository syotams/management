import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TasksService } from './tasks.service';
import { CreateTaskDto, PostponeTaskDto, UpdateTaskDto, CreateCommentDto, FindTasksQueryDto } from './dto/task.dto';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('tasks')
@UseGuards(AuthGuard('jwt'))
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  findAll(@CurrentUser() user: { id: string }, @Query() query: FindTasksQueryDto) {
    return this.tasksService.findAll(user.id, {
      includeClosed: query.includeClosed,
      closedDays: query.closedDays,
    });
  }

  @Get('alerts/pending')
  pendingAlerts(@CurrentUser() user: { id: string }) {
    return this.tasksService.getPendingAlerts(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.tasksService.findOne(id, user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(id, user.id, dto);
  }

  @Patch(':id/start')
  start(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.tasksService.start(id, user.id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.tasksService.complete(id, user.id);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.tasksService.archive(id, user.id);
  }

  @Patch(':id/postpone')
  postpone(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: PostponeTaskDto,
  ) {
    return this.tasksService.postpone(id, user.id, dto);
  }

  @Get(':id/comments')
  getComments(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.tasksService.findOne(id, user.id).then((t) => t.comments);
  }

  @Post(':id/comments')
  addComment(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateCommentDto,
  ) {
    return this.tasksService.addComment(id, user.id, dto);
  }

  @Delete(':id/comments/:commentId')
  deleteComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.tasksService.deleteComment(id, commentId, user.id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.tasksService.findOne(id, user.id).then((t) => t.history);
  }
}
