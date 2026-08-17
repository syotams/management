import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  MinLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsDateString()
  alertAt?: string;
}

export class PostponeTaskDto {
  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsDateString()
  alertAt?: string;

  @IsOptional()
  updateAlert?: boolean;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  alertAt?: string;
}

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  body: string;
}
