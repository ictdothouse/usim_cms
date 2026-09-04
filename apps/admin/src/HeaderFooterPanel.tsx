import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Palette, Star, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as api from "@/lib/api";
import { useT, card } from "./App";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const createSchema = z.object({ name: z.string().trim().min(1, { message: "Required" }) });
type CreateForm = z.infer<typeof createSchema>;

// One list per kind, same quick-create-then-navigate-into-Designer flow as
// PagesPanel — see docs/superpowers/specs/2026-09-04-header-footer-designer-design.md.
function ChromeList({
  kind,
  tenantHost,
  token,
  items,
  refresh,
}: {
  kind: "header" | "footer";
  tenantHost: string;
  token: string;
  items: api.SiteChrome[];
  refresh: () => Promise<void>;
}) {
  const { t } = useT();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { name: "" } });

  async function onCreate(values: CreateForm) {
    try {
      const item = await api.createSiteChrome(tenantHost, token, { kind, name: values.name });
      form.reset();
      await refresh();
      navigate(item.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setDefault(id: string) {
    try {
      await api.updateSiteChrome(tenantHost, token, id, { isDefault: true });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("header-footer-delete-confirm")))) return;
    try {
      await api.deleteSiteChrome(tenantHost, token, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="font-display text-xs font-semibold text-ink">
        {kind === "header" ? t("header-footer-headers") : t("header-footer-footers")}
      </h3>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Card>
        <CardContent className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreate)} className="flex gap-2">
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
      <ul className={`${card} divide-y divide-line/20`}>
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between px-4 py-3 text-xs">
            <button onClick={() => navigate(item.id)} className="flex items-center gap-2 font-semibold text-ink hover:underline">
              <Palette className="h-3.5 w-3.5" /> {item.name}
              {item.isDefault && (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  {t("header-footer-default-badge")}
                </span>
              )}
              {item.status === "draft" && (
                <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-sub">
                  {t("header-footer-draft-badge")}
                </span>
              )}
            </button>
            <span className="flex items-center gap-3">
              {!item.isDefault && (
                <button
                  onClick={() => void setDefault(item.id)}
                  className="rounded p-1 text-body hover:bg-canvas"
                  title={t("header-footer-set-default")}
                >
                  <Star className="h-4 w-4" />
                </button>
              )}
              <button onClick={() => void remove(item.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("header-footer-delete")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("header-footer-empty")}</li>}
      </ul>
    </section>
  );
}

export default function HeaderFooterPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const [items, setItems] = useState<api.SiteChrome[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    <div className="space-y-6">
      <h2 className="font-display text-sm font-semibold text-ink">{t("header-footer-title")}</h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ChromeList kind="header" tenantHost={tenantHost} token={token} items={items.filter((i) => i.kind === "header")} refresh={refresh} />
      <ChromeList kind="footer" tenantHost={tenantHost} token={token} items={items.filter((i) => i.kind === "footer")} refresh={refresh} />
    </div>
  );
}
