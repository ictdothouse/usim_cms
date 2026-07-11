export interface AccessArgs {
  role?: string;
  department?: string;
}

export type AccessFn = (args: AccessArgs) => boolean | Promise<boolean>;

export interface CollectionHooks<T = unknown> {
  beforeChange?: (data: T, args: AccessArgs) => T | Promise<T>;
  afterChange?: (data: T, args: AccessArgs) => void | Promise<void>;
}

export interface CollectionConfig<T = unknown> {
  slug: string;
  access?: {
    read?: AccessFn;
    create?: AccessFn;
    update?: AccessFn;
    delete?: AccessFn;
  };
  hooks?: CollectionHooks<T>;
}
