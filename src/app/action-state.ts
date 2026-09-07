export type ActionState = {
  fieldErrors?: Record<string, string[] | undefined>;
  message: string;
  status: "idle" | "error" | "success";
};

export const initialActionState: ActionState = {
  message: "",
  status: "idle",
};
