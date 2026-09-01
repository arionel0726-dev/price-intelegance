from abc import ABC, abstractmethod

from app.models import ParsedProduct


class ProductParser(ABC):
    @abstractmethod
    async def parse_product(self, url: str) -> ParsedProduct:
        raise NotImplementedError