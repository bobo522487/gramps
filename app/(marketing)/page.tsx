import { BookOpen, GitBranch, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getUser } from '@/lib/db/queries';

const FEATURES = [
  {
    icon: GitBranch,
    title: '谱系',
    description: '以世代为线，梳理支系、成员与亲属关系，让家族脉络清晰可循。',
  },
  {
    icon: ScrollText,
    title: '谱文',
    description:
      '收录传记、家训与散落的手稿，为每一段文字找到它在家族中的位置。',
  },
  {
    icon: BookOpen,
    title: '谱书',
    description: '把核对后的谱系与谱文汇编成册，形成可传阅、可续修的家谱底本。',
  },
];

export default async function HomePage() {
  const user = await getUser();
  const primaryHref = user ? '/dashboard' : '/sign-up';
  const primaryLabel = user ? '进入控制台' : '免费开始';

  return (
    <main className="bg-shell">
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="border-primary/30 bg-primary/10 text-primary inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium">
            家族协作工作台
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
            记录家族脉络
            <span className="text-brand block">续写每一代人的故事</span>
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-2xl text-base sm:text-lg">
            云谱把谱系、谱文与谱书放在同一个协作空间里，让家族成员共同整理、校对与传承。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="brand" size="lg">
              <Link href={primaryHref}>{primaryLabel}</Link>
            </Button>
            {user ? null : (
              <Button asChild variant="outline" size="lg">
                <Link href="/sign-in">登录</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border bg-surface p-6"
            >
              <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-lg">
                <feature.icon className="size-5" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">{feature.title}</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-xl border bg-surface px-6 py-12 text-center sm:px-12">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            从一支谱系开始
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-sm sm:text-base">
            创建组织与项目，邀请家人一起整理、校对，让家族记忆在协作中延续。
          </p>
          <Button asChild variant="brand" size="lg" className="mt-6">
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
