/** `scripts/lib/role-provisioning.mjs` 的类型面：只声明本模块用到的最小接口。 */
export interface RoleSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  unsafe(statement: string): Promise<unknown>;
}

export interface RoleAttributes {
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

export interface EnsureRoleOptions {
  login: boolean;
  /** 空 / 缺省表示**本次不改口令**，不是「用默认口令」。 */
  password?: string | null;
}

export interface EnsureRoleResult {
  status: string;
  /** 目标属性是否与库内一致（或已修好）；不合规交给 verify-deployment 兜底。 */
  attributesCompliant: boolean;
  /** 口令已设置/已更新，或本次没要求改口令。只有「要求改却改不动」才是 false。 */
  canSetPassword: boolean;
}

export function literal(value: string): string;

export function describeRole(
  sql: RoleSql,
  name: string
): Promise<RoleAttributes | null>;

export function roleFixups(
  current: RoleAttributes,
  want: { login: boolean }
): string[];

export function ensureRole(
  sql: RoleSql,
  name: string,
  options: EnsureRoleOptions
): Promise<EnsureRoleResult>;
