import { useState } from "react";
import { Plus, Search, Trash2, Edit } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { 
  useListRespondents, 
  useCreateRespondent, 
  useDeleteRespondent,
  useUpdateRespondent
} from "@/hooks/use-respondents";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { clsx } from "clsx";

export function AdminRespondents() {
  const { data: respondents, isLoading } = useListRespondents();
  const createMutation = useCreateRespondent();
  const updateMutation = useUpdateRespondent();
  const deleteMutation = useDeleteRespondent();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<"AFP" | "General">("General");
  const [search, setSearch] = useState("");

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setEmail("");
    setCategory("General");
    setIsModalOpen(true);
  };

  const openEdit = (r: any) => {
    setEditingId(r.id);
    setName(r.name);
    setEmail(r.email || "");
    setCategory(r.category);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (editingId) {
      await updateMutation.mutateAsync({
        id: editingId,
        data: { name, email: email || null, category }
      });
    } else {
      await createMutation.mutateAsync({
        data: { name, email: email || null, category }
      });
    }
    setIsModalOpen(false);
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this respondent?")) {
      deleteMutation.mutate({ id });
    }
  };

  const filtered = respondents?.filter(r => 
    r.name.toLowerCase().includes(search.toLowerCase()) || 
    (r.email && r.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AdminLayout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Respondents</h1>
          <p className="text-slate-500 mt-1">Manage personnel and their categories.</p>
        </div>
        <Button onClick={openCreate} className="bg-primary hover:bg-primary/90 text-white rounded-xl shadow-md shadow-primary/20">
          <Plus className="w-4 h-4 mr-2" />
          Add Respondent
        </Button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search respondents..." 
              className="pl-9 bg-white border-slate-200 rounded-xl"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400 animate-pulse">Loading...</div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-medium">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered?.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 font-medium text-slate-900">{r.name}</td>
                  <td className="px-6 py-4 text-slate-500">{r.email || '—'}</td>
                  <td className="px-6 py-4">
                    <Badge variant="outline" className={clsx("rounded-md", r.category === 'AFP' ? 'border-indigo-200 text-indigo-700 bg-indigo-50' : 'border-slate-200 text-slate-600 bg-slate-50')}>
                      {r.category}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-blue-600" onClick={() => openEdit(r)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => handleDelete(r.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500">No respondents found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{editingId ? "Edit Respondent" : "Add Respondent"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Full Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Doe" className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Email (Optional)</label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Category</label>
              <Select value={category} onValueChange={(v: "AFP"|"General") => setCategory(v)}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="General">General</SelectItem>
                  <SelectItem value="AFP">AFP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="rounded-xl">Cancel</Button>
            <Button onClick={handleSave} disabled={!name || createMutation.isPending || updateMutation.isPending} className="rounded-xl bg-primary hover:bg-primary/90">
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
