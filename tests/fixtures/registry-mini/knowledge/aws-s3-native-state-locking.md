---
id: aws-s3-native-state-locking
title: S3 native state locking obsoletes DynamoDB
date_authored: 2024-06-15
authoritative_source: https://aws.amazon.com/blogs/aws/
providers: [aws]
triggers:
  - tokens: [s3, backend, lock]
  - tokens: [dynamodb, state, lock]
  - phrase: "do I need dynamodb for terraform state"
overrides_training: true
---

Since AWS provider 5.55 / Terraform 1.10 (June 2024) the s3 backend supports
native state locking via `use_lockfile = true`. A separate DynamoDB table is
no longer required.

```hcl
terraform {
  backend "s3" {
    bucket       = "my-tf-state"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
```
