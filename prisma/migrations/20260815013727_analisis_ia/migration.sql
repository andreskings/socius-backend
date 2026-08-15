-- AlterTable
ALTER TABLE "Candidato" ADD COLUMN     "analisisIaCargoSugeridoId" TEXT,
ADD COLUMN     "analisisIaFecha" TIMESTAMP(3),
ADD COLUMN     "analisisIaPuntaje" INTEGER,
ADD COLUMN     "analisisIaResumen" TEXT;

-- AddForeignKey
ALTER TABLE "Candidato" ADD CONSTRAINT "Candidato_analisisIaCargoSugeridoId_fkey" FOREIGN KEY ("analisisIaCargoSugeridoId") REFERENCES "Busqueda"("id") ON DELETE SET NULL ON UPDATE CASCADE;

