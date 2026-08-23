import { Controller, Get, Post, Body, Query } from "@nestjs/common";
import { SearchService } from "./search.service";

@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post("index")
  async indexPost(@Body() post: any) {
    return this.searchService.indexPost(post);
  }

  @Get()
  async search(@Query("q") query: string) {
    return this.searchService.search(query);
  }
}
