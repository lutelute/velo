import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, ArrowLeft } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { insertJmapAccount } from "@/services/db/accounts";
import { useAccountStore } from "@/stores/accountStore";
import { discoverJmapUrl } from "@/services/jmap/autoDiscovery";
import { JmapClient } from "@/services/jmap/client";

interface AddJmapAccountProps {
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

type Step = "basic" | "discover" | "test";

export function AddJmapAccount({ onClose, onSuccess, onBack }: AddJmapAccountProps) {
  const [step, setStep] = useState<Step>("basic");
  const [email, setEmail] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [jmapUrl, setJmapUrl] = useState("");
  const [authMethod, setAuthMethod] = useState<"basic" | "bearer">("basic");
  const [discovering, setDiscovering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addAccount = useAccountStore((s) => s.addAccount);

  const handleDiscover = async () => {
    setDiscovering(true);
    setError(null);

    try {
      const result = await discoverJmapUrl(email);
      if (result) {
        setJmapUrl(result.sessionUrl);
        setStep("test");
      } else {
        // No auto-discovery — let user enter manually
        setStep("discover");
      }
    } catch {
      setStep("discover");
    } finally {
      setDiscovering(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);

    try {
      const credential =
        authMethod === "basic"
          ? btoa(`${email}:${authToken}`)
          : authToken;

      const client = new JmapClient(jmapUrl, authMethod, credential);
      const result = await client.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const accountId = crypto.randomUUID();

      await insertJmapAccount({
        id: accountId,
        email,
        displayName: null,
        avatarUrl: null,
        jmapUrl,
        authMethod: authMethod === "basic" ? "password" : "bearer",
        password: authMethod === "basic" ? authToken : undefined,
        accessToken: authMethod === "bearer" ? authToken : undefined,
      });

      addAccount({
        id: accountId,
        email,
        displayName: null,
        avatarUrl: null,
        isActive: true,
      });

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account");
      setSaving(false);
    }
  };

  const renderBasicStep = () => (
    <>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@fastmail.com"
            className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            Authentication Method
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setAuthMethod("basic")}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                authMethod === "basic"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-primary bg-bg-tertiary text-text-secondary hover:bg-bg-hover"
              }`}
            >
              App Password
            </button>
            <button
              onClick={() => setAuthMethod("bearer")}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                authMethod === "bearer"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-primary bg-bg-tertiary text-text-secondary hover:bg-bg-hover"
              }`}
            >
              Bearer Token
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            {authMethod === "basic" ? "App Password" : "Access Token"}
          </label>
          <input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder={authMethod === "basic" ? "Enter your app password" : "Enter your access token"}
            className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {authMethod === "basic" && (
            <p className="text-xs text-text-tertiary mt-1">
              Generate an app-specific password in your email provider settings.
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-3 justify-between mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDiscover}
            disabled={!email || !authToken || discovering}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {discovering && <Loader2 className="w-4 h-4 animate-spin" />}
            {discovering ? "Discovering..." : "Continue"}
          </button>
        </div>
      </div>
    </>
  );

  const renderDiscoverStep = () => (
    <>
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Auto-discovery didn't find a JMAP server. Enter the session URL manually.
        </p>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            JMAP Session URL
          </label>
          <input
            type="url"
            value={jmapUrl}
            onChange={(e) => setJmapUrl(e.target.value)}
            placeholder="https://mail.example.com/.well-known/jmap"
            className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-border-primary rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="text-xs text-text-tertiary mt-1">
            Usually https://your-server/.well-known/jmap or similar.
          </p>
        </div>
      </div>

      <div className="flex gap-3 justify-between mt-6">
        <button
          onClick={() => setStep("basic")}
          className="flex items-center gap-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={() => setStep("test")}
          disabled={!jmapUrl}
          className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Test Connection
        </button>
      </div>
    </>
  );

  const renderTestStep = () => (
    <>
      <div className="space-y-4">
        <div className="bg-bg-tertiary rounded-lg p-3 text-sm">
          <div className="text-text-secondary">
            <span className="font-medium text-text-primary">Server:</span> {jmapUrl}
          </div>
          <div className="text-text-secondary mt-1">
            <span className="font-medium text-text-primary">Account:</span> {email}
          </div>
        </div>

        {testResult && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              testResult.success
                ? "bg-success/10 text-success"
                : "bg-danger/10 text-danger"
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 flex-shrink-0" />
            )}
            {testResult.message}
          </div>
        )}

        {error && (
          <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">
            {error}
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-between mt-6">
        <button
          onClick={() => setStep("discover")}
          className="flex items-center gap-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex gap-3">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 text-sm border border-border-primary rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {testing && <Loader2 className="w-4 h-4 animate-spin" />}
            {testing ? "Testing..." : "Test"}
          </button>
          <button
            onClick={handleSave}
            disabled={!testResult?.success || saving}
            className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Saving..." : "Add Account"}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <Modal isOpen={true} onClose={onClose} title="Add JMAP Account" width="w-full max-w-md">
      <div className="p-4">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {(["basic", "discover", "test"] as const).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-border-primary" />}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  step === s
                    ? "bg-accent text-white"
                    : (["basic", "discover", "test"].indexOf(step) > i)
                      ? "bg-accent/20 text-accent"
                      : "bg-bg-tertiary text-text-tertiary"
                }`}
              >
                {i + 1}
              </div>
            </div>
          ))}
        </div>

        {step === "basic" && renderBasicStep()}
        {step === "discover" && renderDiscoverStep()}
        {step === "test" && renderTestStep()}
      </div>
    </Modal>
  );
}
