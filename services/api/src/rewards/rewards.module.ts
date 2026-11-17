import { Body, Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { AuthGuard, AuthUser, CurrentUser, AuthModule } from '../auth/auth';
import { RewardsService } from './rewards.service';

class ClaimReferralDto {
  @IsString()
  @Matches(/^[A-F0-9]{16}$/)
  code!: string;
}

@Controller('rewards')
@UseGuards(AuthGuard)
class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser) {
    return this.rewards.summary(user.id);
  }

  @Post('referrals/claim')
  claimReferral(@CurrentUser() user: AuthUser, @Body() body: ClaimReferralDto) {
    return this.rewards.claimReferral(user.id, body.code);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [RewardsController],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
