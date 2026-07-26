import { NoticeBar } from "./nutui-adapter";

export const stringNoticeContent = <NoticeBar content="string content remains supported" />;

// @ts-expect-error NutUI NoticeBar accepts string content, not arbitrary React nodes.
export const nodeNoticeContent = <NoticeBar content={<button type="button">invalid content</button>} />;
