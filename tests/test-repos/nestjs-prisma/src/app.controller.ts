import { Controller, Get } from "@nestjs/common";
import { User } from "./user.entity";

@Controller()
export class AppController {
  constructor() {}

  @Get()
  getHello(): User {
    return new User();
  }
}
