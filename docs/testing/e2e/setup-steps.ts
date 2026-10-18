/**
 * 建 context 的分步计时（#1061）。
 *
 * 夹具建 context 要走好几步：清 profile、启动浏览器、装 init script、等首装
 * 欢迎页、关掉扩展页。原先只有等欢迎页一步有自己的上限，其余几步不带上限 ——
 * 启动浏览器那一步沿用 Playwright 的默认值，恰好也是 180 秒，卡住时把整条
 * 用例的预算一口气吃光，报错只剩一句“setting up "context" 超时”，看不出卡在
 * 哪一步。
 *
 * 这里给每一步记下开始时刻与耗时、各自一个上限。哪一步超了上限就在那一步报错，
 * 报出是哪一步、等了多久、前面各步各用了多久。各步上限加起来远小于用例的 180
 * 秒，所以卡住时报的总是具体那一步。
 *
 * 浏览器进程自己的启动日志（<launching>、<launched> pid、stderr）不在这里收：
 * Playwright 1.62 的 logger 只给 api 这一路，进程日志只进它自己报错里的 call
 * log。启动那一步超了 Playwright 自己的上限时，原错误连同 call log 挂在 cause 上、
 * 原文进失败信息。
 *
 * 只让失败能说话，不重试、不放宽：超了上限照样失败。
 */
/** 一步的记录：名字、相对建 context 开始的时刻、耗时（还在跑时没有）。 */
interface StepRecord {
  name: string;
  at: number;
  ms?: number;
}

export class SetupStepError extends Error {
  constructor(
    /** 卡住或出错的那一步 */
    readonly step: string,
    /** 这一步从开始到报错用了多久 */
    readonly elapsedMs: number,
    /** true：超了这一步自己的上限；false：这一步自己抛了错 */
    readonly timedOut: boolean,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SetupStepError';
  }
}

export class SetupTimeline {
  private readonly t0 = Date.now();
  private readonly steps: StepRecord[] = [];

  /**
   * 跑一步，超过 limitMs 就以这一步的名义报错。run 可以是同步的（比如清
   * profile），同步的那种只记耗时 —— 同步代码没法在中途打断。
   */
  async step<T>(name: string, limitMs: number, run: () => T | Promise<T>): Promise<T> {
    const record: StepRecord = { name, at: Date.now() - this.t0 };
    this.steps.push(record);
    const start = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const ms = Date.now() - start;
        reject(
          new SetupStepError(
            name,
            ms,
            true,
            `建 context 卡在“${name}”：等了 ${ms} 毫秒（上限 ${limitMs} 毫秒）\n${this.report()}`,
          ),
        );
      }, limitMs);
    });
    try {
      const value = await Promise.race([Promise.resolve().then(run), limit]);
      record.ms = Date.now() - start;
      return value;
    } catch (e) {
      if (e instanceof SetupStepError) throw e;
      const ms = Date.now() - start;
      const reason = e instanceof Error ? e.message : String(e);
      throw new SetupStepError(
        name,
        ms,
        false,
        `建 context 在“${name}”出错（${ms} 毫秒）：${reason}\n${this.report()}`,
        { cause: e },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** 时间线：各步相对建 context 开始的时刻与耗时。 */
  report(): string {
    const steps = this.steps
      .map((s) => `  +${s.at}ms ${s.name} ${s.ms === undefined ? '（未完成）' : `${s.ms}ms`}`)
      .join('\n');
    return `各步耗时：\n${steps}`;
  }
}
