import { IsString, IsEmail, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  name: string;
}

export class InviteMemberDto {
  @IsEmail()
  email: string;
}
