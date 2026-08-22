import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateEpicDto, CreateQuarterDto, AddQuarterParticipantDto, AssignEpicDto, UpdateEpicDto, UpdateQuarterDto } from './dto/quarter.dto';
import { QuartersService } from './quarters.service';

@Controller('quarters')
@UseGuards(AuthGuard('jwt'))
export class QuartersController {
  constructor(private quartersService: QuartersService) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateQuarterDto) {
    return this.quartersService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.quartersService.findAll(user.id);
  }

  @Get(':id/compare')
  compare(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quartersService.compare(id, user.id);
  }

  @Get(':id/addable-participants')
  addableParticipants(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.quartersService.listAddableParticipants(id, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quartersService.findOne(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateQuarterDto,
  ) {
    return this.quartersService.update(id, user.id, dto);
  }

  @Patch(':id/start')
  start(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quartersService.start(id, user.id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quartersService.complete(id, user.id);
  }

  @Post(':id/participants')
  addParticipant(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AddQuarterParticipantDto,
  ) {
    return this.quartersService.addParticipant(id, user.id, dto);
  }

  @Post(':id/epics')
  addEpic(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateEpicDto,
  ) {
    return this.quartersService.addEpic(id, user.id, dto);
  }

  @Post(':id/epics/:epicId/assign')
  assignEpic(
    @Param('id') id: string,
    @Param('epicId') epicId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AssignEpicDto,
  ) {
    return this.quartersService.assignEpic(id, epicId, user.id, dto);
  }

  @Patch(':id/epics/:epicId')
  updateEpic(
    @Param('id') id: string,
    @Param('epicId') epicId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateEpicDto,
  ) {
    return this.quartersService.updateEpic(id, epicId, user.id, dto);
  }

  @Delete(':id/epics/:epicId')
  deleteEpic(
    @Param('id') id: string,
    @Param('epicId') epicId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.quartersService.deleteEpic(id, epicId, user.id);
  }
}
