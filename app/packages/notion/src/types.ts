/** The only Notion surface this tool uses. Read methods only: there is no write method to call. */
export interface PageObject {
  id: string;
  last_edited_time: string;
  properties: Record<string, PropertyValue>;
  [key: string]: unknown;
}

export interface PropertyValue {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface DataSourceInfo {
  id: string;
  title: string;
  properties: Record<string, PropertyConfig>;
}

export interface PropertyConfig {
  id?: string;
  name?: string;
  type: string;
  [key: string]: unknown;
}

export interface PageMarkdown {
  markdown: string;
  truncated: boolean;
  unknownBlockIds: string[];
}

export interface NotionReader {
  retrieveDataSource(dataSourceId: string): Promise<DataSourceInfo>;
  /** Every page of the data source, paged to the end. Order is not guaranteed. */
  listPages(dataSourceId: string): AsyncIterable<PageObject>;
  retrieveMarkdown(pageId: string): Promise<PageMarkdown>;
}

export interface ProjectDatabase {
  slug: string;
  dataSourceId: string;
}

export interface Project {
  name: string;
  /** Absolute folder that holds project.md. */
  folder: string;
  databases: ProjectDatabase[];
}

export interface ManifestDatabase {
  slug: string;
  data_source_id: string;
  title: string;
  pages: number;
  markdown_truncated: number;
  schema_sha256: string;
  sha256: string;
  error?: string;
}

export interface Manifest {
  format: 1;
  project: string;
  date: string;
  databases: ManifestDatabase[];
  totals: { databases: number; pages: number; markdown_truncated: number; errors: number };
  sha256: string;
}
