import pg from "pg";

// Dates stay as ISO strings, matching the previous Data API responses.
pg.types.setTypeParser(1082, (v) => v);
const parseTimestamp = pg.types.getTypeParser(1184);
pg.types.setTypeParser(1184, (v) => (parseTimestamp(v) as Date).toISOString());
pg.types.setTypeParser(20, (v) => Number(v));
export default pg;
