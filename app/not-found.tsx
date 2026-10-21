import { CircleIcon } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center">
      <div className="max-w-md space-y-8 p-4 text-center">
        <div className="flex justify-center">
          <CircleIcon className="size-12 text-brand" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">页面未找到</h1>
        <p className="text-muted-foreground text-base">
          你访问的页面可能已被移除、重命名，或暂时无法访问。
        </p>
        <Link
          href="/"
          className="border-input bg-surface hover:bg-accent hover:text-accent-foreground mx-auto flex max-w-48 justify-center rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
