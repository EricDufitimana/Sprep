import { createTRPCRouter } from '../init';
import { healthRouter } from './health';
import { checkRouter } from './check';
import { answersRouter } from './answers';
import { errorsRouter } from './errors';
import { profileRouter } from './profile';
import { progressRouter } from './progress';
import { questionBanksManagementRouter } from './question-banks-management';
import { modulesManagementRouter } from './modules-management';
import { questionsRouter } from './questions';
import { testsRouter } from './tests';
import { vocabularyManagementRouter } from './vocabulary-management';
import { vocabularyRouter } from './vocabulary';
import { vocabularyTrainerRouter } from './vocabulary-trainer';

export const appRouter = createTRPCRouter({
  health: healthRouter,
  tests: testsRouter,
  answers: answersRouter,
  errors: errorsRouter,
  questions: questionsRouter,
  questionBanksManagement: questionBanksManagementRouter,
  modulesManagement: modulesManagementRouter,
  vocabularyManagement: vocabularyManagementRouter,
  vocabulary: vocabularyRouter,
  vocabularyTrainer: vocabularyTrainerRouter,
  progress: progressRouter,
  profile: profileRouter,
  check: checkRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
