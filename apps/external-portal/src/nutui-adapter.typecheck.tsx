import { NoticeBar } from "./nutui-adapter";

export const stringNoticeContent = <NoticeBar content="string-only external notice" />;
// @ts-expect-error NutUI NoticeBar content is string-only.
export const nodeNoticeContent = <NoticeBar content={<button type="button">invalid</button>} />;
