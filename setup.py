from setuptools import setup, find_packages

setup(
    name="raunch",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "anthropic>=0.40.0",
        "click>=8.1.0",
        "rich>=13.0.0",
    ],
    entry_points={
        "console_scripts": [
            "raunch=raunch.main:main",
        ],
    },
)
