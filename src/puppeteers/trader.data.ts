export const STOP_LOSS_DEVIATION = 3; // 2 (%)
export const CONSERVATIVE_STOP_LOSS_DEVIATION = 1.5; // 1 (%)
export const INTERMEDIATE_STOP_LOSS_DEVIATION = 2.5; // 2.5 (%)

export const CONSERVATIVE_STOP_LOSS_BREAKPOINT = 3; // 2 (%)
export const INTERMEDIATE_STOP_LOSS_BREAKPOINT = 5; // 5 (%)

export const LONG_STOP_LOSS_DEVIATION = -STOP_LOSS_DEVIATION;
export const SHORT_STOP_LOSS_DEVIATION = +STOP_LOSS_DEVIATION;

export const CONSERVATIVE_LONG_STOP_LOSS_DEVIATION =
	-CONSERVATIVE_STOP_LOSS_DEVIATION;
export const CONSERVATIVE_SHORT_STOP_LOSS_DEVIATION =
	+CONSERVATIVE_STOP_LOSS_DEVIATION;

export const INTERMEDIATE_LONG_STOP_LOSS_DEVIATION =
	-INTERMEDIATE_STOP_LOSS_DEVIATION;
export const INTERMEDIATE_SHORT_STOP_LOSS_DEVIATION =
	+INTERMEDIATE_STOP_LOSS_DEVIATION;

