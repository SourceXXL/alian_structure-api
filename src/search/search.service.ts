import { Injectable } from "@nestjs/common";
import { ElasticsearchService } from "@nestjs/elasticsearch";

@Injectable()
export class SearchService {
  constructor(private readonly esService: ElasticsearchService) {}

  async indexPost(post: any) {
    return this.esService.index({
      index: "posts",
      document: post,
    });
  }

  async search(query: string) {
    const result = await this.esService.search({
      index: "posts",
      query: {
        multi_match: {
          query,
          fields: ["title", "content"],
        },
      },
    });
    return result.hits.hits.map((hit) => hit._source);
  }
}
