// Exit codes shared by the `data:*` CLIs, so a wrapper script can tell a
// *finding* from a *failure* without parsing stdout:
//
//   0  the command did what it was asked
//   1  a finding: the reconciliation found a diff, or the organization is
//      already backfilled (the tool refuses on purpose, and that is an answer)
//   2  usage: missing or malformed arguments
//   3  could not run: bad credentials, missing tables, connection refused
export const EXIT_OK = 0;
export const EXIT_FINDING = 1;
export const EXIT_USAGE = 2;
export const EXIT_INFRASTRUCTURE = 3;
