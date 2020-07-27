export type Edge = {
  source: string;
  target: string;
};

export type Node = {
  id: string;
  path: string;
  label: string;
  links: string[];
  backlinks: string[];
  visited?: boolean;
};

export type Graph = {
  nodes: Node[];
  edges: Edge[];
};

export type State = {
  adjacencyList: Record<string, Node>;
  currentNode?: string;
};

export type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  url?: string;
  value?: string;
  depth?: number;
  data?: {
    permalink?: string;
  };
};
