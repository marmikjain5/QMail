import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import { Shield, ShieldAlert, Paperclip, Send, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const formSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
});

export function ComposePage() {
  const { toast } = useToast();
  const [securityLevel, setSecurityLevel] = useState<2 | 3>(2);
  const [file, setFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ sufficient: boolean; availableMb: string; channelHealth: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      to: '',
      subject: '',
      body: '',
    },
  });

  const bodyContent = form.watch('body');

  useEffect(() => {
    async function checkKeyPool() {
      try {
        const payloadBytes = new Blob([bodyContent]).size + (file?.size || 0);
        const res = await api.get('/emails/key-availability', {
          params: { level: securityLevel, payloadBytes },
        });
        setKeyStatus(res.data);
      } catch (err) {
        console.error('Failed to check key availability', err);
      }
    }
    const timeout = setTimeout(checkKeyPool, 500);
    return () => clearTimeout(timeout);
  }, [bodyContent, file, securityLevel]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      if (e.target.files[0].size > 100 * 1024 * 1024) {
        toast({ title: "File too large", description: "Max attachment size is 100MB", variant: "destructive" });
        return;
      }
      setFile(e.target.files[0]);
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (keyStatus && !keyStatus.sufficient) {
      toast({
        title: 'Insufficient Quantum Keys',
        description: 'Wait for the QKD simulator to generate more keys or switch to Level 2.',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      let attachmentRefs = [];
      
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('securityLevel', String(securityLevel));
        
        const attachRes = await api.post('/attachments/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        attachmentRefs.push(attachRes.data);
      }

      await api.post('/emails/send', {
        ...values,
        to: [values.to],
        securityLevel,
        attachmentRefs,
      });

      toast({
        title: 'Encrypted Message Sent',
        description: 'Your message was secured and transmitted successfully.',
      });
      form.reset();
      setFile(null);
    } catch (err: any) {
      toast({
        title: 'Failed to send',
        description: err.response?.data?.userMessage || err.message,
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-950 p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Compose Secure Message</h1>
      
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 flex-1 flex flex-col">
        <div className="space-y-2">
          <Input placeholder="To" {...form.register('to')} className="text-lg py-6" />
          {form.formState.errors.to && (
            <span className="text-sm text-red-500">{form.formState.errors.to.message}</span>
          )}
        </div>

        <div className="space-y-2">
          <Input placeholder="Subject" {...form.register('subject')} className="text-lg py-6" />
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4" /> Security Level
          </h3>
          <div className="flex gap-4">
            <div 
              className={`flex-1 border rounded-md p-4 cursor-pointer transition-colors ${securityLevel === 2 ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950' : 'border-slate-200 dark:border-slate-800'}`}
              onClick={() => setSecurityLevel(2)}
            >
              <div className="font-semibold text-cyan-600 dark:text-cyan-400">Level 2: Quantum-AES</div>
              <div className="text-xs text-slate-500 mt-1">AES-256-GCM with quantum-distributed 256-bit keys. Fast, low key consumption.</div>
            </div>
            
            <div 
              className={`flex-1 border rounded-md p-4 cursor-pointer transition-colors ${securityLevel === 3 ? 'border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950' : 'border-slate-200 dark:border-slate-800'}`}
              onClick={() => setSecurityLevel(3)}
            >
              <div className="font-semibold text-fuchsia-600 dark:text-fuchsia-400">Level 3: Quantum-OTP</div>
              <div className="text-xs text-slate-500 mt-1">Information-theoretic secure One-Time Pad. Consumes keys equal to message size.</div>
            </div>
          </div>
          
          {keyStatus && (
            <div className="mt-4 text-xs flex items-center justify-between">
              <span className={keyStatus.sufficient ? 'text-emerald-500' : 'text-red-500 flex items-center gap-1'}>
                {!keyStatus.sufficient && <ShieldAlert className="h-3 w-3" />}
                {keyStatus.sufficient ? 'Sufficient keys available.' : 'Insufficient keys in QKM pool.'}
              </span>
              <span className="text-slate-500">
                Pool: {keyStatus.availableMb} MB | Channel: {keyStatus.channelHealth}
              </span>
            </div>
          )}
        </div>

        <Textarea 
          placeholder="Write your message here..." 
          className="flex-1 min-h-[300px] resize-none text-base p-4"
          {...form.register('body')}
        />

        {file && (
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-2 rounded w-max border border-slate-200 dark:border-slate-700">
            <Paperclip className="h-4 w-4 text-slate-500" />
            <span className="text-sm truncate max-w-[200px]">{file.name}</span>
            <span className="text-xs text-slate-400">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
            <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full ml-2" onClick={() => setFile(null)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        <div className="flex justify-between items-center pt-4 border-t border-slate-200 dark:border-slate-800">
          <div>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileChange}
            />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4 mr-2" /> Attach File
            </Button>
          </div>
          
          <Button type="submit" disabled={isSending || (keyStatus ? !keyStatus.sufficient : false)} className="w-32 bg-cyan-600 hover:bg-cyan-700 text-white">
            {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" /> Send</>}
          </Button>
        </div>
      </form>
    </div>
  );
}
