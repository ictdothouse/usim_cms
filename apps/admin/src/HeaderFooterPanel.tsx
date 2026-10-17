import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PanelTop, Search } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import * as api from "@/lib/api";
import { useT, inputCls, card, FormError, ListLoading, ListEmpty } from "./App";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Kind = "header" | "footer";

const createSchema = z.object({ name: z.string().trim().min(1, { message: "Required" }) });
type CreateForm = z.infer<typeof createSchema>;

const actionCls = "font-semibold hover:underline";
const badgeCls = "rounded-full px-2 py-0.5 text-sm font-bold";

// One tab per kind, same quick-create-then-navigate-into-Designer flow as
// PagesPanel — see docs/superpowers/specs/2026-09-04-header-footer-designer-design.md.
// Trash is a soft delete: status "trash", which RLS already keeps off the
// site (a page pinned to it falls back to the default). Restore brings it
// back as a draft; only "Delete permanently" is the real DELETE.
function ChromeList({
  kind,
  tenantHost,
  token,
  items,
  refresh,
}: {
  kind: Kind;
  tenantHost: string;
  token: string;
  items: api.SiteChrome[];
  refresh: () => Promise<void>;
}) {
  const { t } = useT();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [trashView, setTrashView] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { name: "" } });

  const trashed = items.filter((i) => i.status === "trash");
  const active = items.filter((i) => i.status !== "trash");
  const q = search.trim().toLowerCase();
  const shown = (trashView ? trashed : active).filter((i) => i.name.toLowerCase().includes(q));

  // Every row action: write, then reload the list, or show the error.
  async function run(write: () => Promise<unknown>) {
    try {
      await write();
      setError(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const update = (id: string, patch: Record<string, unknown>) => api.updateSiteChrome(tenantHost, token, id, patch);

  async function onCreate(values: CreateForm) {
    try {
      const item = await api.createSiteChrome(tenantHost, token, { kind, name: values.name });
      navigate(item.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // The copy takes what the Designer shows: a published row's autosaved edit, if any.
  const duplicate = (item: api.SiteChrome) =>
    run(() =>
      api.createSiteChrome(tenantHost, token, {
        kind,
        name: `${item.name} ${t("header-footer-copy-suffix")}`,
        layout: item.draft?.layout ?? item.layout,
        settings: item.settings,
        translations: item.translations,
      }),
    );

  // No confirm: Undo puts the old status and default flag back.
  const trash = (item: api.SiteChrome) =>
    run(async () => {
      await update(item.id, { status: "trash" });
      toast(t("header-footer-trashed"), {
        action: { label: t("designer-undo"), onClick: () => void run(() => update(item.id, { status: item.status, isDefault: item.isDefault })) },
      });
    });

  const restore = (item: api.SiteChrome) =>
    run(async () => {
      await update(item.id, { status: "draft" });
      toast(t("header-footer-restored"));
    });

  async function deleteForever(item: api.SiteChrome) {
    if (await confirm(t("header-footer-delete-confirm"))) await run(() => api.deleteSiteChrome(tenantHost, token, item.id));
  }

  async function emptyTrash() {
    if (await confirm(t("header-footer-empty-trash-confirm"))) {
      await run(() => Promise.all(trashed.map((i) => api.deleteSiteChrome(tenantHost, token, i.id))));
    }
  }

  function rename(item: api.SiteChrome, value: string) {
    setRenaming(null);
    const name = value.trim();
    if (name && name !== item.name) void run(() => update(item.id, { name }));
  }

  return (
    <div className="space-y-3">
      <FormError>{error}</FormError>
      <Card>
        <CardContent className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreate)} className="flex flex-col gap-2 sm:flex-row">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input required placeholder={t("header-footer-name")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
                {kind === "header" ? t("header-footer-new-header") : t("header-footer-new-footer")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 text-sm">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={trashView === v}
              onClick={() => setTrashView(v)}
              className={`font-semibold ${trashView === v ? "text-ink" : "text-accent hover:underline"}`}
            >
              {t(v ? "header-footer-trash" : "header-footer-all")} <span className="font-normal text-sub">({(v ? trashed : active).length})</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sub" />
          <input
            type="search"
            aria-label={t("header-footer-search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("header-footer-search")}
            className={`${inputCls} py-1.5 pl-8`}
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <ListEmpty>{t(q ? "header-footer-no-match" : trashView ? "header-footer-trash-empty" : "header-footer-empty")}</ListEmpty>
      ) : (
        <ul className={`${card} divide-y divide-line/20`}>
          {shown.map((item) => (
            <li key={item.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {renaming === item.id ? (
                  <input
                    autoFocus
                    defaultValue={item.name}
                    aria-label={t("header-footer-name")}
                    onBlur={(e) => rename(item, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") e.currentTarget.value = item.name;
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                    className={`${inputCls} max-w-xs py-1`}
                  />
                ) : trashView ? (
                  <span className="font-semibold text-ink">{item.name}</span>
                ) : (
                  <button onClick={() => navigate(item.id)} className="font-semibold text-ink hover:underline">
                    {item.name}
                  </button>
                )}
                {item.isDefault && <span className={`${badgeCls} bg-accent/10 text-accent`}>{t("header-footer-default-badge")}</span>}
                {item.status === "draft" && <span className={`${badgeCls} bg-warn/10 text-warn`}>{t("header-footer-draft-badge")}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {trashView ? (
                  <>
                    <button onClick={() => void restore(item)} className={`${actionCls} text-accent`}>{t("designer-restore")}</button>
                    <button onClick={() => void deleteForever(item)} className={`${actionCls} text-red-600`}>{t("header-footer-delete")}</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => navigate(item.id)} className={`${actionCls} text-accent`}>{t("posts-edit")}</button>
                    <button onClick={() => void duplicate(item)} className={`${actionCls} text-body`}>{t("designer-duplicate")}</button>
                    <button onClick={() => setRenaming(item.id)} className={`${actionCls} text-body`}>{t("menus-rename")}</button>
                    {!item.isDefault && (
                      <button onClick={() => void run(() => update(item.id, { isDefault: true }))} className={`${actionCls} text-body`}>
                        {t("header-footer-set-default")}
                      </button>
                    )}
                    <button onClick={() => void trash(item)} className={`${actionCls} text-red-600`}>{t("header-footer-trash-action")}</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {trashView && trashed.length > 0 && (
        <button onClick={() => void emptyTrash()} className={`${actionCls} text-sm text-red-600`}>
          {t("header-footer-empty-trash")}
        </button>
      )}
    </div>
  );
}

export default function HeaderFooterPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [items, setItems] = useState<api.SiteChrome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // In the URL so the Designer's close button lands back on the same tab.
  const [params, setParams] = useSearchParams();
  const tab: Kind = params.get("tab") === "footer" ? "footer" : "header";

  async function refresh() {
    try {
      setItems(await api.listSiteChrome(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantHost]);

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
        <PanelTop className="h-4 w-4 text-accent" /> {t("header-footer-title")}
      </h2>
      <FormError>{error}</FormError>
      {items === null ? (
        !error && <ListLoading />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) =>
            setParams(
              (p) => {
                p.set("tab", v);
                return p;
              },
              { replace: true },
            )
          }
        >
          <TabsList>
            {(["header", "footer"] as const).map((k) => (
              <TabsTrigger key={k} value={k} className="gap-1.5">
                {t(k === "header" ? "header-footer-headers" : "header-footer-footers")}
                <span className="text-xs text-sub">{items.filter((i) => i.kind === k && i.status !== "trash").length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {(["header", "footer"] as const).map((k) => (
            <TabsContent key={k} value={k} className="mt-3">
              <ChromeList kind={k} tenantHost={tenantHost} token={token} items={items.filter((i) => i.kind === k)} refresh={refresh} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </section>
  );
}
