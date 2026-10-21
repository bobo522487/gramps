'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="mx-auto max-w-2xl px-4 py-24 text-center">
          <h1 className="mb-4 text-2xl font-semibold">出了点问题</h1>
          <p className="mb-2 text-gray-600">加载应用时发生了严重错误。</p>
          <p className="mb-8 text-sm text-gray-500">
            错误编号：{error.digest ?? '未知'}
          </p>
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-4 py-2 text-sm font-medium"
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
