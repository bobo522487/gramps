import postgres from 'postgres';
const url = process.env.POSTGRES_URL_DIRECT;
const u = new URL(url);
console.log('host:', u.hostname);
console.log('port:', u.port || '(默认)');
console.log('db:', u.pathname.slice(1));
console.log('has sslmode:', u.search);
const sql = postgres(url, { max: 1 });
try {
  const [r] = await sql`select inet_server_addr()::text as addr, inet_server_port() as port,
    current_setting('server_version') as ver,
    (select count(*) from pg_stat_activity) as conns`;
  console.log('server:', r.addr, 'port:', r.port, 'ver:', r.ver);
  const [role] = await sql`select rolcreaterole, rolsuper from pg_roles where rolname = current_user`;
  console.log('当前角色 CREATEROLE =', role.rolcreaterole, ' SUPER =', role.rolsuper);
  const dbs = await sql`select count(*)::int c from pg_database`;
  console.log('库数:', dbs[0].c);
} catch (e) {
  console.log('probe error:', e.code, e.message);
} finally { await sql.end(); }
