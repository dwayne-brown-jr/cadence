"use client";

import { useState, useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Copy, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { MERGE_FIELD_TOKENS, applyMergeFields } from "@/lib/email";
import { RichTextEditor } from "./rich-text-editor";

const TEMPLATE_TYPES = [
  { value: "WELCOME", label: "Welcome" },
  { value: "STAGE_CHANGE", label: "Stage Change" },
  { value: "FOLLOW_UP", label: "Follow-Up" },
  { value: "REMINDER", label: "Reminder" },
  { value: "CUSTOM", label: "Custom" },
];

const SAMPLE_MERGE_DATA = {
  client_name: "Jane Smith",
  client_email: "jane@example.com",
  client_phone: "(555) 867-5309",
  project_type: "Website Redesign",
  project_value: "$4,800",
  stage_name: "Design Review",
  workspace_name: "Acme Studio",
  company_name: "Acme Studio",
  portal_url: "https://app.example.com/portal/abc123",
  days_in_stage: "3",
};

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string(),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
});

type FormValues = z.infer<typeof schema>;

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
  type: string;
  isActive: boolean;
  _count: { emailLogs: number };
};

function LivePreview({ subject, body }: { subject: string; body: string }) {
  const renderedSubject = applyMergeFields(subject, SAMPLE_MERGE_DATA);
  const renderedBody = applyMergeFields(body, SAMPLE_MERGE_DATA, { html: true });

  return (
    <div className="flex flex-col h-full border rounded-md overflow-hidden bg-white">
      <div className="px-3 py-2 border-b bg-muted/40">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
      </div>
      <div className="px-4 py-3 border-b bg-gray-50">
        <p className="text-[10px] text-muted-foreground">Subject</p>
        <p className="text-sm font-medium truncate">{renderedSubject || <span className="italic text-muted-foreground">No subject</span>}</p>
      </div>
      {/* Sandboxed (no allow-scripts): template HTML can never run code in the viewer's session. */}
      <iframe
        title="Email body preview"
        sandbox=""
        className="flex-1 w-full bg-white"
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:12px 16px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;overflow-wrap:break-word}</style></head><body>${
          renderedBody || '<p style="color:#9ca3af;font-style:italic">Body will appear here…</p>'
        }</body></html>`}
      />
    </div>
  );
}

export function TemplateDialog({
  open,
  onClose,
  template,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  template?: TemplateRow | null;
  onSaved: (t: TemplateRow) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const isEdit = !!template;

  async function handleAiGenerate() {
    if (!aiDescription.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: aiDescription,
          type: form.getValues("type"),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Generation failed");
      }
      const data = await res.json() as { subject: string; body: string };
      form.setValue("subject", data.subject, { shouldDirty: true });
      form.setValue("body", data.body, { shouldDirty: true });
      toast.success("Template generated!");
      setAiOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI generation failed");
    } finally {
      setAiLoading(false);
    }
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      name: "",
      type: "CUSTOM",
      subject: "",
      body: "",
    },
  });

  const watchedSubject = useWatch({ control: form.control, name: "subject" });
  const watchedBody = useWatch({ control: form.control, name: "body" });

  useEffect(() => {
    if (open) {
      form.reset(
        template
          ? { name: template.name, type: template.type, subject: template.subject, body: template.body }
          : { name: "", type: "CUSTOM", subject: "", body: "" }
      );
    }
  }, [open, template, form]);

  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      const url = isEdit ? `/api/email-templates/${template.id}` : "/api/email-templates";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error("Failed");
      const saved = await res.json();
      toast.success(isEdit ? "Template updated" : "Template created");
      onSaved(saved);
      onClose();
    } catch {
      toast.error("Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  function insertToken(token: string) {
    const bodyField = form.getValues("body");
    form.setValue("body", bodyField + token, { shouldDirty: true });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[92vw] sm:max-w-[92vw] h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Template" : "New Template"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-2 gap-4 min-h-0">
          {/* Left: form */}
          <div className="overflow-y-auto pr-1">
            {/* AI Generator */}
            <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/60 overflow-hidden">
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-violet-100/50 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <span className="text-xs font-semibold text-violet-700 flex-1">Generate with AI</span>
                {aiOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-violet-400" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-violet-400" />
                )}
              </button>
              {aiOpen && (
                <div className="px-3 pb-3 space-y-2">
                  <Textarea
                    value={aiDescription}
                    onChange={(e) => setAiDescription(e.target.value)}
                    placeholder="Describe the email (e.g. &quot;Welcome email for new clients starting the design phase, remind them to check their portal&quot;)"
                    rows={3}
                    className="text-xs resize-none"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                    disabled={aiLoading || !aiDescription.trim()}
                    onClick={handleAiGenerate}
                  >
                    {aiLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Generating…</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Generate Subject & Body</>
                    )}
                  </Button>
                </div>
              )}
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Template Name *</FormLabel>
                        <FormControl>
                          <Input {...field} className="h-9" placeholder="e.g. Welcome Email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Type</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TEMPLATE_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="subject"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Subject Line *</FormLabel>
                      <FormControl>
                        <Input {...field} className="h-9" placeholder="e.g. Welcome to {{workspace_name}}!" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Merge fields */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    Merge fields — click to insert into body:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {MERGE_FIELD_TOKENS.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        onClick={() => insertToken(t.token)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted hover:bg-muted/70 text-xs font-mono transition-colors"
                      >
                        <Copy className="h-2.5 w-2.5" />
                        {t.token}
                      </button>
                    ))}
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="body"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Body *</FormLabel>
                      <FormControl>
                        <RichTextEditor
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Hi {{client_name}}, Welcome to {{workspace_name}}!"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    {isEdit ? "Save Changes" : "Create Template"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>

          {/* Right: live preview */}
          <LivePreview subject={watchedSubject} body={watchedBody} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
