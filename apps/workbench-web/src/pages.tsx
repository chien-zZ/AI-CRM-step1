import { PageContainer } from "@ant-design/pro-components";
import { Alert, Card, Descriptions, Empty, Flex, Pagination, Segmented, Select, Tag, Typography } from "antd";
import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { PlatformCollection, PlatformItem } from "./workbench-port";

const { Text } = Typography;
const PAGE_SIZE = 5;

interface CollectionUrlState {
  filter: string;
  page: number;
  selected?: string;
  tab: "active" | "history";
}

export interface NormalizedCollectionState extends CollectionUrlState {
  items: PlatformItem[];
}

export function normalizeCollectionState(
  collection: PlatformCollection,
  input: { filter: string; page: number; selected?: string; tab: string },
  pathSelection?: string,
): NormalizedCollectionState {
  const pathItem = pathSelection === undefined ? undefined : collection.items.find((item) => item.id === pathSelection);
  const tab = pathItem?.tab ?? (input.tab === "history" ? "history" : "active");
  const requestedFilter = input.filter === "all" || collection.statuses.includes(input.filter) ? input.filter : "all";
  const allowedFilter = pathItem !== undefined && requestedFilter !== "all" && pathItem.status !== requestedFilter ? "all" : requestedFilter;
  const filtered = collection.items.filter((item) => item.tab === tab && (allowedFilter === "all" || item.status === allowedFilter));
  const requestedSelection = pathSelection ?? input.selected;
  const selectedIndex = requestedSelection === undefined ? -1 : filtered.findIndex((item) => item.id === requestedSelection);
  const maximumPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const requestedPage = Number.isSafeInteger(input.page) && input.page > 0 ? Math.min(input.page, maximumPage) : 1;
  const page = selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE_SIZE) + 1 : requestedPage;
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = selectedIndex >= 0 ? filtered[selectedIndex]?.id : items[0]?.id;
  return { filter: allowedFilter, items, page, ...(selected === undefined ? {} : { selected }), tab };
}

function useCollectionUrlState(collection: PlatformCollection): NormalizedCollectionState & {
  update: (changes: Record<string, string | undefined>) => void;
} {
  const { itemId } = useParams<{ itemId?: string }>();
  const [params, setParams] = useSearchParams();
  const pageValue = Number(params.get("page") ?? "1");
  const raw = useMemo(() => ({
    filter: params.get("filter") ?? "all",
    page: Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    ...(params.get("selected") === null ? {} : { selected: params.get("selected") as string }),
    tab: params.get("tab") ?? "active",
  }), [pageValue, params]);
  const normalized = useMemo(() => normalizeCollectionState(collection, raw, itemId), [collection, itemId, raw]);

  const update = (changes: Record<string, string | undefined>): void => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    });
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const canonical = new URLSearchParams(params);
    canonical.set("tab", normalized.tab);
    canonical.set("filter", normalized.filter);
    canonical.set("page", String(normalized.page));
    if (normalized.selected === undefined) canonical.delete("selected");
    else canonical.set("selected", normalized.selected);
    if (canonical.toString() !== params.toString()) setParams(canonical, { replace: true });
  }, [normalized.filter, normalized.page, normalized.selected, normalized.tab, params, setParams]);

  return { ...normalized, update };
}

export function CollectionPage({ collection }: { collection: PlatformCollection }): React.JSX.Element {
  const state = useCollectionUrlState(collection);
  const selected = collection.items.find((item) => item.id === state.selected);
  const total = collection.items.filter((item) => item.tab === state.tab && (state.filter === "all" || item.status === state.filter)).length;

  return (
    <PageContainer title={collection.title} subTitle="平台能力视图">
      {collection.fixture && <Alert className="fixture-alert" type="info" showIcon title="开发 Fixture" description="以下内容是合成数据，仅用于开发和测试，不代表生产事实。" />}
      <Flex gap={16} className="master-detail">
        <Card className="collection-list" size="small">
          <Flex vertical gap={12}>
            <Segmented
              aria-label="数据范围"
              value={state.tab}
              options={[{ label: "当前", value: "active" }, { label: "历史", value: "history" }]}
              onChange={(value) => { state.update({ tab: String(value), page: "1", selected: undefined }); }}
            />
            <Select
              aria-label="状态筛选"
              value={state.filter}
              options={[{ label: "全部状态", value: "all" }, ...collection.statuses.map((value) => ({ label: value, value }))]}
              onChange={(value) => { state.update({ filter: value, page: "1", selected: undefined }); }}
            />
            {state.items.length === 0
              ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可显示内容" />
              : <div role="list" className="platform-list">
                {state.items.map((item) => (
                  <div role="listitem" className="platform-list-item" key={item.id}>
                    <button
                      type="button"
                      className={selected?.id === item.id ? "collection-item selected" : "collection-item"}
                      aria-pressed={selected?.id === item.id}
                      onClick={() => { state.update({ selected: item.id }); }}
                    >
                      <Flex justify="space-between" gap={8} className="collection-item-heading">
                        <Text strong className="truncate-text" title={item.title}>{item.title}</Text>
                        <Tag className="stable-tag" title={item.status}>{item.status}</Tag>
                      </Flex>
                      <Text type="secondary" className="summary-text" title={item.summary}>{item.summary}</Text>
                    </button>
                  </div>
                ))}
              </div>}
            <Pagination
              current={state.page}
              pageSize={PAGE_SIZE}
              total={total}
              onChange={(page) => { state.update({ page: String(page), selected: undefined }); }}
              showSizeChanger={false}
              hideOnSinglePage
            />
          </Flex>
        </Card>
        <Card className="collection-detail" size="small" title="详情">
          {selected ? <ItemDetail item={selected} /> : <Empty description="当前范围暂无可选内容" />}
        </Card>
      </Flex>
    </PageContainer>
  );
}

function ItemDetail({ item }: { item: PlatformItem }): React.JSX.Element {
  return (
    <Descriptions column={1} size="small" bordered className="stable-descriptions">
      <Descriptions.Item label="稳定引用"><span className="break-text">{item.id}</span></Descriptions.Item>
      <Descriptions.Item label="名称"><span className="break-text">{item.title}</span></Descriptions.Item>
      <Descriptions.Item label="状态"><span className="break-text">{item.status}</span></Descriptions.Item>
      <Descriptions.Item label="摘要"><span className="break-text">{item.summary}</span></Descriptions.Item>
    </Descriptions>
  );
}
