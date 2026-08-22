import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateEpicDto, CreateProjectDto, AddProjectParticipantDto, AssignEpicDto, CreateHolidayDto, CreatePtoDto, UpdateEpicDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(AuthGuard('jwt'))
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.projectsService.findAll(user.id);
  }

  @Get(':id/compare')
  compare(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.projectsService.compare(id, user.id);
  }

  @Get(':id/addable-participants')
  addableParticipants(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.projectsService.listAddableParticipants(id, user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.projectsService.findOne(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, user.id, dto);
  }

  @Patch(':id/start')
  start(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.projectsService.start(id, user.id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.projectsService.complete(id, user.id);
  }

  @Post(':id/participants')
  addParticipant(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AddProjectParticipantDto,
  ) {
    return this.projectsService.addParticipant(id, user.id, dto);
  }

  @Post(':id/epics')
  addEpic(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateEpicDto,
  ) {
    return this.projectsService.addEpic(id, user.id, dto);
  }

  @Post(':id/epics/:epicId/assign')
  assignEpic(
    @Param('id') id: string,
    @Param('epicId') epicId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AssignEpicDto,
  ) {
    return this.projectsService.assignEpic(id, epicId, user.id, dto);
  }

  @Patch(':id/epics/:epicId')
  updateEpic(
    @Param('id') id: string,
    @Param('epicId') epicId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateEpicDto,
  ) {
    return this.projectsService.updateEpic(id, epicId, user.id, dto);
  }

  @Delete(':id/epics/:epicId')
  deleteEpic(
    @Param('id') id: string,
    @Param('epicId') epicId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.projectsService.deleteEpic(id, epicId, user.id);
  }

  @Post(':id/holidays')
  addHoliday(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateHolidayDto,
  ) {
    return this.projectsService.addHoliday(id, user.id, dto);
  }

  @Delete(':id/holidays/:holidayId')
  deleteHoliday(
    @Param('id') id: string,
    @Param('holidayId') holidayId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.projectsService.deleteHoliday(id, holidayId, user.id);
  }

  @Delete(':id/holiday-groups/:groupKey')
  deleteHolidayGroup(
    @Param('id') id: string,
    @Param('groupKey') groupKey: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.projectsService.deleteHolidayGroup(id, groupKey, user.id);
  }

  @Post(':id/pto')
  addPto(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreatePtoDto,
  ) {
    return this.projectsService.addPto(id, user.id, dto);
  }

  @Delete(':id/pto/:ptoId')
  deletePto(
    @Param('id') id: string,
    @Param('ptoId') ptoId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.projectsService.deletePto(id, ptoId, user.id);
  }
}
