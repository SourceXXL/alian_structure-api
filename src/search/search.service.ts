import { Injectable } from "@nestjs/common";
import { ElasticsearchService } from "@nestjs/elasticsearch";

@Injectable()
export class SearchService {
  constructor(private readonly esService: ElasticsearchService) {}

  async indexPost(post: any) {
    return this.esService.index({
      index: "posts",
      body: post,
    });
  }

  async search(query: string) {
    const { body } = await this.esService.search({
      index: "posts",
      body: {
        query: {
          multi_match: {
            query,
            fields: ["title", "content"],
          },
        },
      },
    });
    return body.hits.hits.map((hit) => hit._source);
  }
}
