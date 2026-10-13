export type Layout =
  | "mindmap"
  | "right"
  | "left"
  | "org"
  | "tree"
  | "timeline"
  | "fishbone"
  | "radial"
  | "brace"
  | "treetable"
  | "matrix"
  | "org-up"
  | "timeline-vertical";
export type Theme =
  "classic" | "ocean" | "forest" | "sunset" | "violet" | "mono" | "dark";
export type Shape = "round" | "rect" | "ellipse" | "underline" | "diamond";
export interface TopicStyle {
  color?: string;
  textColor?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  shape?: Shape;
}
export interface TopicTask {
  status: "todo" | "doing" | "done";
  start?: string;
  end?: string;
  assignee?: string;
  progress?: number;
}
export interface RichTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}
export interface Topic {
  id: string;
  title: string;
  children: Topic[];
  collapsed?: boolean;
  note?: string;
  url?: string;
  image?: string;
  markers?: string[];
  labels?: string[];
  floating?: { x: number; y: number };
  richText?: RichTextRun[];
  task?: TopicTask;
  style?: TopicStyle;
  equation?: string;
  attachment?: { name: string; data: string; type: string };
}
export interface Relation {
  id: string;
  from: string;
  to: string;
  label: string;
  color?: string;
}
export interface Annotation {
  id: string;
  kind: "boundary" | "summary";
  topicIds: string[];
  label: string;
  color?: string;
}
export interface Sheet {
  id: string;
  title: string;
  root: Topic;
  layout: Layout;
  theme: Theme;
  relations: Relation[];
  annotations: Annotation[];
  numbering?: "none" | "decimal" | "hierarchical" | "roman";
}
export interface Workbook {
  version: 1;
  id: string;
  title: string;
  sheets: Sheet[];
  activeSheetId: string;
  updatedAt: string;
}
export interface LayoutNode {
  id: string;
  title: string;
  topic: Topic;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  color: string;
  side: "left" | "right" | "center";
}
export interface LayoutEdge {
  from: string;
  to: string;
  color: string;
  path: string;
}
export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  bounds: { x: number; y: number; width: number; height: number };
}
