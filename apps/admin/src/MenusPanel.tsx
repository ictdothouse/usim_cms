import { useEffect, useState } from "react";
import { Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import * as api from "@/lib/api";
import { useT, inputCls, card } from "./App";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import MenuItemsEditor from "./MenuItemsEditor";

const createSchema = z.object({ name: z.string().trim().min(1, { message: "Required" }) });
type CreateForm = z.infer<typeof createSchema>;

export default function MenusPanel({ tenantHost, token }: { tenantHost: string; token: string }) {
  const { t } = useT();
  const confirm = useConfirm();
  const [menus, setMenus] = useState<api.Menu[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<CreateForm>({ resolver: zodResolver(createSchema), defaultValues: { name: "" } });

  async function refresh() {
    try {
      setMenus(await api.listMenus(tenantHost, token));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenantHost]);

  async function onCreate(values: CreateForm) {
    try {
      const created = await api.createMenu(tenantHost, token, values.name);
      form.reset();
      await refresh();
      setOpenId(created.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    try {
      await api.updateMenu(tenantHost, token, id, { name: trimmed });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!(await confirm(t("menus-delete-confirm")))) return;
    try {
      await api.deleteMenu(tenantHost, token, id);
      if (openId === id) setOpenId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="font-display text-sm font-semibold text-ink">{t("menus-title")}</h2>
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
                      <Input required placeholder={t("menus-name")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting} className="shrink-0">
                {form.formState.isSubmitting ? t("menus-creating") : t("menus-create")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <ul className={`${card} divide-y divide-line/20`}>
        {menus.map((m) => (
          <li key={m.id}>
            <div className="flex items-center justify-between px-4 py-3 text-xs">
              <button
                onClick={() => setOpenId(openId === m.id ? null : m.id)}
                className="flex items-center gap-2 font-semibold text-ink"
              >
                {openId === m.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {editingId === m.id ? (
                  <input
                    className={inputCls}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void rename(m.id)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  m.name
                )}
              </button>
              <span className="flex items-center gap-3">
                {editingId === m.id ? (
                  <>
                    <Button size="sm" onClick={() => void rename(m.id)}>{t("menus-save")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t("menus-cancel")}</Button>
                  </>
                ) : (
                  <button
                    onClick={() => { setEditingId(m.id); setEditName(m.name); }}
                    className="rounded p-1 text-body hover:bg-canvas"
                    title={t("menus-rename")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => void remove(m.id)} className="rounded p-1 text-red-500 hover:bg-red-50" title={t("menus-delete")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
            {openId === m.id && (
              <div className="border-t border-line/20 bg-canvas/40 px-4 py-3">
                <MenuItemsEditor
                  tenantHost={tenantHost}
                  token={token}
                  menu={m}
                  onSaved={refresh}
                />
              </div>
            )}
          </li>
        ))}
        {menus.length === 0 && <li className="px-4 py-3 text-xs text-sub">{t("menus-empty")}</li>}
      </ul>
    </section>
  );
}
