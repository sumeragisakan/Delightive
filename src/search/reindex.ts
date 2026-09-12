import { createDatabase } from "../db/connection";
import { SearchService } from "../db/services/search-service";

const connection = createDatabase();

try {
  const result = new SearchService(connection).rebuildAll();
  console.log(
    `Search index rebuilt: ${result.documents} documents across ${result.cases} cases (${connection.databasePath})`,
  );
} finally {
  connection.sqlite.close();
}
