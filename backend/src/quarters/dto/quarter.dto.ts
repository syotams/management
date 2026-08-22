import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

const emptyToNull = ({ value }: { value: unknown }) =>
  value === '' ? null : value;

export class CreateQuarterDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  teamId?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  teamIds?: string[];

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}

export class UpdateQuarterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @Transform(emptyToNull)
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  teamId?: string | null;
}

export class AddQuarterParticipantDto {
  @IsString()
  userId: string;
}

export class CreateEpicDto {
  @IsString()
  @MinLength(1)
  title: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  workingDays: number;

  @Transform(emptyToNull)
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startSprintNumber?: number | null;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsString()
  @Matches(/^#([0-9a-fA-F]{6})$/, { message: 'backgroundColor must be a hex color like #4f46e5' })
  backgroundColor: string;
}

export class AssignEpicDto {
  @IsString()
  assigneeId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  startSprintNumber: number;
}

export class UpdateEpicDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  workingDays?: number;

  @Transform(emptyToNull)
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startSprintNumber?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  assigneeIds?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{6})$/, { message: 'backgroundColor must be a hex color like #4f46e5' })
  backgroundColor?: string;
}
