export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string;
          entity_id: string;
          entity_table: string;
          id: number;
          new_record: Json | null;
          occurred_at: string;
          old_record: Json | null;
          owner_user_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          entity_id: string;
          entity_table: string;
          id?: never;
          new_record?: Json | null;
          occurred_at?: string;
          old_record?: Json | null;
          owner_user_id: string;
        };
        Update: {
          action?: string;
          entity_id?: string;
          entity_table?: string;
          id?: never;
          new_record?: Json | null;
          occurred_at?: string;
          old_record?: Json | null;
          owner_user_id?: string;
        };
        Relationships: [];
      };
      benefit_periods: {
        Row: {
          allowance_cents: number | null;
          allowance_units: number | null;
          benefit_id: string;
          card_id: string;
          coverage_status: string;
          coverage_through: string | null;
          created_at: string;
          id: string;
          last_reconciled_at: string | null;
          notes: string;
          owner_user_id: string;
          period_end_exclusive: string;
          period_start: string;
          rule_snapshot: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          allowance_cents?: number | null;
          allowance_units?: number | null;
          benefit_id: string;
          card_id: string;
          coverage_status?: string;
          coverage_through?: string | null;
          created_at?: string;
          id?: string;
          last_reconciled_at?: string | null;
          notes?: string;
          owner_user_id?: string;
          period_end_exclusive: string;
          period_start: string;
          rule_snapshot: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          allowance_cents?: number | null;
          allowance_units?: number | null;
          benefit_id?: string;
          card_id?: string;
          coverage_status?: string;
          coverage_through?: string | null;
          created_at?: string;
          id?: string;
          last_reconciled_at?: string | null;
          notes?: string;
          owner_user_id?: string;
          period_end_exclusive?: string;
          period_start?: string;
          rule_snapshot?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "benefit_periods_owner_user_id_card_id_benefit_id_fkey";
            columns: ["owner_user_id", "card_id", "benefit_id"];
            isOneToOne: false;
            referencedRelation: "benefits";
            referencedColumns: ["owner_user_id", "card_id", "id"];
          },
        ];
      };
      benefits: {
        Row: {
          cadence: string;
          card_id: string;
          category: string;
          created_at: string;
          custom_end_exclusive: string | null;
          description: string;
          effective_from: string;
          effective_to: string | null;
          eligibility_rules_json: NonNullable<Json>;
          eligibility_status: string;
          enabled: boolean;
          enrollment_required: boolean;
          enrollment_status: string;
          id: string;
          issuer_source_url: string | null;
          manual_verification_required: boolean;
          name: string;
          nominal_amount_cents: number | null;
          nominal_units: number | null;
          owner_user_id: string;
          reset_anchor: string | null;
          rule_key: string;
          unit_label: string | null;
          updated_at: string;
          verified_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          cadence: string;
          card_id: string;
          category?: string;
          created_at?: string;
          custom_end_exclusive?: string | null;
          description?: string;
          effective_from: string;
          effective_to?: string | null;
          eligibility_rules_json?: NonNullable<Json>;
          eligibility_status?: string;
          enabled?: boolean;
          enrollment_required?: boolean;
          enrollment_status?: string;
          id?: string;
          issuer_source_url?: string | null;
          manual_verification_required?: boolean;
          name: string;
          nominal_amount_cents?: number | null;
          nominal_units?: number | null;
          owner_user_id?: string;
          reset_anchor?: string | null;
          rule_key?: string;
          unit_label?: string | null;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          cadence?: string;
          card_id?: string;
          category?: string;
          created_at?: string;
          custom_end_exclusive?: string | null;
          description?: string;
          effective_from?: string;
          effective_to?: string | null;
          eligibility_rules_json?: NonNullable<Json>;
          eligibility_status?: string;
          enabled?: boolean;
          enrollment_required?: boolean;
          enrollment_status?: string;
          id?: string;
          issuer_source_url?: string | null;
          manual_verification_required?: boolean;
          name?: string;
          nominal_amount_cents?: number | null;
          nominal_units?: number | null;
          owner_user_id?: string;
          reset_anchor?: string | null;
          rule_key?: string;
          unit_label?: string | null;
          updated_at?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "benefits_owner_user_id_card_id_fkey";
            columns: ["owner_user_id", "card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["owner_user_id", "id"];
          },
        ];
      };
      cards: {
        Row: {
          archived_at: string | null;
          art_design: string | null;
          cardmember_anchor_date: string | null;
          catalog_key: string | null;
          created_at: string;
          display_name: string;
          id: string;
          identity_verified_at: string | null;
          issuer: string;
          issuer_timezone: string;
          last4: string | null;
          owner_user_id: string;
          product_name: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived_at?: string | null;
          art_design?: string | null;
          cardmember_anchor_date?: string | null;
          catalog_key?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          identity_verified_at?: string | null;
          issuer: string;
          issuer_timezone?: string;
          last4?: string | null;
          owner_user_id?: string;
          product_name?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          art_design?: string | null;
          cardmember_anchor_date?: string | null;
          catalog_key?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          identity_verified_at?: string | null;
          issuer?: string;
          issuer_timezone?: string;
          last4?: string | null;
          owner_user_id?: string;
          product_name?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      redemption_evidence: {
        Row: {
          amount_cents: number | null;
          benefit_period_id: string;
          card_id: string;
          confidence: string;
          confirmation_result: string;
          eligibility_result: string;
          id: string;
          merchant: string | null;
          notes: string;
          owner_user_id: string;
          recorded_at: string;
          recorded_by: string;
          source_reference_hash: string | null;
          source_type: string;
          supersedes_evidence_id: string | null;
          transaction_date: string;
          units: number | null;
        };
        ComputedFields: never;
        Insert: {
          amount_cents?: number | null;
          benefit_period_id: string;
          card_id: string;
          confidence: string;
          confirmation_result?: string;
          eligibility_result?: string;
          id?: string;
          merchant?: string | null;
          notes?: string;
          owner_user_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          source_reference_hash?: string | null;
          source_type: string;
          supersedes_evidence_id?: string | null;
          transaction_date: string;
          units?: number | null;
        };
        Update: {
          amount_cents?: number | null;
          benefit_period_id?: string;
          card_id?: string;
          confidence?: string;
          confirmation_result?: string;
          eligibility_result?: string;
          id?: string;
          merchant?: string | null;
          notes?: string;
          owner_user_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          source_reference_hash?: string | null;
          source_type?: string;
          supersedes_evidence_id?: string | null;
          transaction_date?: string;
          units?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "redemption_evidence_owner_user_id_benefit_period_id_supers_fkey";
            columns: [
              "owner_user_id",
              "benefit_period_id",
              "supersedes_evidence_id",
            ];
            isOneToOne: false;
            referencedRelation: "redemption_evidence";
            referencedColumns: ["owner_user_id", "benefit_period_id", "id"];
          },
          {
            foreignKeyName: "redemption_evidence_owner_user_id_card_id_benefit_period_i_fkey";
            columns: ["owner_user_id", "card_id", "benefit_period_id"];
            isOneToOne: false;
            referencedRelation: "benefit_periods";
            referencedColumns: ["owner_user_id", "card_id", "id"];
          },
          {
            foreignKeyName: "redemption_evidence_owner_user_id_card_id_benefit_period_i_fkey";
            columns: ["owner_user_id", "card_id", "benefit_period_id"];
            isOneToOne: false;
            referencedRelation: "period_balances";
            referencedColumns: ["owner_user_id", "card_id", "id"];
          },
        ];
      };
      sync_runs: {
        Row: {
          candidates_found: number;
          confirmed_updates: number;
          coverage_summary_json: NonNullable<Json>;
          error_summary: string | null;
          finished_at: string | null;
          id: string;
          owner_user_id: string;
          periods_checked: number;
          request_digest: string | null;
          request_key: string;
          started_at: string;
          status: string;
          trigger: string;
        };
        ComputedFields: never;
        Insert: {
          candidates_found?: number;
          confirmed_updates?: number;
          coverage_summary_json?: NonNullable<Json>;
          error_summary?: string | null;
          finished_at?: string | null;
          id?: string;
          owner_user_id?: string;
          periods_checked?: number;
          request_digest?: string | null;
          request_key?: string;
          started_at?: string;
          status: string;
          trigger: string;
        };
        Update: {
          candidates_found?: number;
          confirmed_updates?: number;
          coverage_summary_json?: NonNullable<Json>;
          error_summary?: string | null;
          finished_at?: string | null;
          id?: string;
          owner_user_id?: string;
          periods_checked?: number;
          request_digest?: string | null;
          request_key?: string;
          started_at?: string;
          status?: string;
          trigger?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      period_balances: {
        Row: {
          allowance_cents: number | null;
          allowance_units: number | null;
          benefit_id: string;
          benefit_name: string;
          cadence: string;
          candidate_cents: number | null;
          candidate_units: number | null;
          card_id: string;
          card_name: string;
          card_status: string;
          confirmed_cents: number | null;
          confirmed_units: number | null;
          coverage_status: string;
          coverage_through: string | null;
          created_at: string;
          eligibility_status: string;
          enabled: boolean;
          enrollment_required: boolean;
          enrollment_status: string;
          id: string;
          identity_verified_at: string | null;
          issuer: string;
          issuer_timezone: string;
          last_reconciled_at: string | null;
          last4: string | null;
          negative_balance: boolean | null;
          notes: string;
          owner_user_id: string;
          period_end_exclusive: string;
          period_start: string;
          remaining_cents: number | null;
          remaining_units: number | null;
          rule_snapshot: NonNullable<Json>;
          unresolved_count: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "benefit_periods_owner_user_id_card_id_benefit_id_fkey";
            columns: ["owner_user_id", "card_id", "benefit_id"];
            isOneToOne: false;
            referencedRelation: "benefits";
            referencedColumns: ["owner_user_id", "card_id", "id"];
          },
        ];
      };
    };
    Functions: {
      add_ink_cards: { Args: Record<PropertyKey, never>; Returns: undefined };
      anniversary: {
        Args: { p_anchor: string; p_year: number };
        Returns: string;
      };
      apply_reconciliation: {
        Args: {
          p_evidence: Json;
          p_periods: Json;
          p_request_key: string;
          p_summary: Json;
          p_trigger: string;
        };
        Returns: {
          candidates_found: number;
          confirmed_updates: number;
          coverage_summary_json: NonNullable<Json>;
          error_summary: string | null;
          finished_at: string | null;
          id: string;
          owner_user_id: string;
          periods_checked: number;
          request_digest: string | null;
          request_key: string;
          started_at: string;
          status: string;
          trigger: string;
        };
        SetofOptions: {
          from: "*";
          to: "sync_runs";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      ensure_period: {
        Args: { p_benefit_id: string; p_on?: string };
        Returns: {
          allowance_cents: number | null;
          allowance_units: number | null;
          benefit_id: string;
          card_id: string;
          coverage_status: string;
          coverage_through: string | null;
          created_at: string;
          id: string;
          last_reconciled_at: string | null;
          notes: string;
          owner_user_id: string;
          period_end_exclusive: string;
          period_start: string;
          rule_snapshot: NonNullable<Json>;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "benefit_periods";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      initialize_cards: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      period_window: {
        Args: {
          p_anchor: string;
          p_cadence: string;
          p_custom_end: string;
          p_effective_from: string;
          p_effective_to: string;
          p_on: string;
        };
        Returns: {
          partial_rule_window: boolean;
          period_end_exclusive: string;
          period_start: string;
        }[];
      };
      record_evidence: {
        Args: { p_record: Json };
        Returns: {
          amount_cents: number | null;
          benefit_period_id: string;
          card_id: string;
          confidence: string;
          confirmation_result: string;
          eligibility_result: string;
          id: string;
          merchant: string | null;
          notes: string;
          owner_user_id: string;
          recorded_at: string;
          recorded_by: string;
          source_reference_hash: string | null;
          source_type: string;
          supersedes_evidence_id: string | null;
          transaction_date: string;
          units: number | null;
        };
        SetofOptions: {
          from: "*";
          to: "redemption_evidence";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      version_benefit: {
        Args: {
          p_benefit_id: string;
          p_changes: Json;
          p_effective_from: string;
        };
        Returns: {
          cadence: string;
          card_id: string;
          category: string;
          created_at: string;
          custom_end_exclusive: string | null;
          description: string;
          effective_from: string;
          effective_to: string | null;
          eligibility_rules_json: NonNullable<Json>;
          eligibility_status: string;
          enabled: boolean;
          enrollment_required: boolean;
          enrollment_status: string;
          id: string;
          issuer_source_url: string | null;
          manual_verification_required: boolean;
          name: string;
          nominal_amount_cents: number | null;
          nominal_units: number | null;
          owner_user_id: string;
          reset_anchor: string | null;
          rule_key: string;
          unit_label: string | null;
          updated_at: string;
          verified_at: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "benefits";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
