import { Settings2 } from "lucide-react";
import { Card } from "./ui/card";
import { HintSettingsForm } from "./hint-settings-form";
export function BotSettingsPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Bot settings</h1>
          <p>Choose the default hint provider and model for your chats.</p>
        </div>
      </div>
      <Card className="bot-settings-card block gap-0 p-0">
        <div className="send-panel-heading">
          <Settings2 size={18} />
          <div>
            <h2>Hint generation</h2>
            <p>Model changes apply to new hint requests without redeploying.</p>
          </div>
        </div>
        <div className="p-4">
          <HintSettingsForm />
        </div>
      </Card>
    </>
  );
}
