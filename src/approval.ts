import type {
  ApprovalOutcome,
  ApprovalProvider,
  ApprovalRequest,
} from "./tools.ts";

/** 测试和无交互部署使用的固定一次性审批 Provider。 */
export class AutomaticApprovalProvider implements ApprovalProvider {
  constructor(private readonly outcome: ApprovalOutcome) {}

  request(_request: Readonly<ApprovalRequest>): ApprovalOutcome {
    return this.outcome;
  }
}
